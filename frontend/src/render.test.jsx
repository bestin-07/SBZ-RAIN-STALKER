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
import RainRibbon, { dryRunIn, MIN_BRACKET_BARS, confidencePct, bucketMixed } from './components/RainRibbon'
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

    it('DayStrip renders five rows', () => {
      const html = renderToStaticMarkup(<DayStrip daily={daily()} theme="light" t={t} lang={lang} />)
      expect(html).toContain(t('today_short'))
      expect((html.match(/<svg/g) || []).length).toBe(5)   // one glyph per day
      expect(html).toContain('%')
      // v2.39.4 — the "best window" headline is gone (maintainer call); pinning
      // its absence so it can't quietly resurface.
      expect(translations[lang].best_window).toBeUndefined()
      expect(translations[lang].best_window_none).toBeUndefined()
    })

    it('skipToday drops the today row — today is the tile above, not a thin row', () => {
      // v2.32: today is drawn as the tall tile from radar + model. Repeating it here
      // would claim the same day twice, from two instruments, at two resolutions.
      const full = renderToStaticMarkup(<DayStrip daily={daily()} theme="light" t={t} lang={lang} />)
      const trimmed = renderToStaticMarkup(<DayStrip daily={daily()} theme="light" t={t} lang={lang} skipToday />)
      expect((full.match(/<svg/g) || []).length).toBe(5)
      expect((trimmed.match(/<svg/g) || []).length).toBe(4)
      expect(full).toContain(t('today_short'))
      expect(trimmed).not.toContain(t('today_short'))
      // …and the section says plainly that what is left is all forecast.
      expect(trimmed).toContain(esc(t('days_title_forecast')))
    })

    // v2.39.2 — the pinned "RADAR · NEXT X H ⋯ FORECAST · MODEL" caption row
    // is gone (it restated what the scrub readout's own source line already
    // says as the cursor moves — maintainer call). The readout is now the
    // ONLY place the chart names its instrument; at rest (slot 0, "now")
    // that must read "Radar" whenever a real radar zone actually covers now.
    it('the readout names Radar at rest when a real radar zone covers now', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map(() => 0), isNowcast: true,
                                radarUntil: now + 2.66 * 3600 }}
                    theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).toContain(esc(t('ro_src_radar')))
      expect(html).not.toContain(esc(t('ro_src_model')))
      // The old pinned caption row is gone outright.
      expect(html).not.toContain('NEXT')
      expect(translations[lang].zone_radar).toBeUndefined()
      expect(translations[lang].zone_forecast).toBeUndefined()
    })

    // v2.34/v2.39.2 — a radar zone that has aged down to minutes, or a
    // model-only fallback, must never claim "Radar" at the cursor's rest
    // position: the readout has to fall back to naming the forecast model.
    // (The source line is matched as its own element, not a bare substring
    // search — the dry-window overlay legitimately says "radar" too, e.g.
    // "Radar sieht keinen Regen …", and a loose match would collide with it.)
    it('the readout names the forecast model at rest when there is no real radar zone', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const srcLine = html => html.match(/text-primary shrink-0">([^<]*)<\/span>/)?.[1]
      for (const forecast of [
        { times, precips: times.map(() => 0), isNowcast: false, radarUntil: now },
        { times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 300 },
      ]) {
        const html = renderToStaticMarkup(
          <RainRibbon forecast={forecast} theme="light" t={t}
                      unstable={false} modelRainMin={null} />)
        expect(srcLine(html)).toBe(esc(t('ro_src_model')))
      }
    })

    // …and with no data at all it makes no attribution claim whatsoever, rather
    // than describing a chart that has not been drawn.
    it('withholds the source line entirely when there is no data', () => {
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times: [], precips: [] }} theme="light" t={t}
                    unstable={false} modelRainMin={null} />)
      expect(html).not.toContain(esc(t('ro_src_radar')))
      expect(html).not.toContain(esc(t('ro_src_model')))
    })

    // v2.36 — the intensity swatch key (DRY/LIGHT/MOD/HEAVY/STORM) is gone from
    // the ribbon: the palette collapsed to two wet colours, and height was
    // already continuous (v2.23), so a bar's own colour+height already say what
    // the key used to spell out in words. Pinning the deletion at the i18n level
    // — the canvas colours themselves are an imperative side effect invisible to
    // renderToStaticMarkup, so a colour is not something this suite can assert.
    it('drops the intensity swatch key strings entirely', () => {
      for (const k of ['key_dry', 'key_light', 'key_mod', 'key_heavy', 'key_storm']) {
        expect(translations[lang][k]).toBeUndefined()
      }
    })

    // v2.36.1 — the "forecast"/legend_model chip is gone: it explained a dashed
    // outline that used to mark EVERY model-zone bar, and now that dashing is
    // reserved for actual disagreement, a plain dim bar needs no chip (the
    // pinned zone row already names the zone). The trace chip is unaffected;
    // the disagreement chip now needs a REAL agree:false slot to earn its spot.
    it('keeps the trace chip, drops the old blanket "forecast" chip', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{
          times, precips: times.map((_, i) => [0.05, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][i]),
          isNowcast: true, radarUntil: now + 300,
        }} theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).toContain(esc(t('legend_trace')))
      expect(html).not.toContain(esc(t('legend_uncertain')))
    })

    it('the disagreement chip appears only when a real agree:false slot exists', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{
          times, precips: times.map((_, i) => (i === 1 ? 0.3 : 0)),
          modelAgree: times.map((_, i) => i !== 1),
          isNowcast: true, radarUntil: now + 300,
        }} theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).toContain(esc(t('legend_uncertain')))
    })

    // v2.38 — the ribbon's own header row ("TODAY · NEXT 12H") is gone for
    // good, in both languages; the zone row directly below is now the first
    // thing the ribbon says.
    it('no longer renders its own TODAY / NEXT 12H header row', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).not.toContain(esc(t('today_short')))
    })

    // v2.39.2 — `confidencePct` replaces the old 5-block `confidencePips`
    // as the underlying READING (a continuous percentage instead of five
    // discrete steps): full in the radar zone unless the reading is itself
    // a sub-threshold trace echo, reading the model's own probability in
    // the forecast zone, a further deduction when the two forecast models
    // disagree, and a cautious middle value when there is no probability
    // reading at all (never omitted — the same "unknown reads as caution"
    // doctrine used throughout gaps.js). Floored at 20 — never an empty bar.
    // v2.39.3 reverted the DRAWN shape back to five blocks (`pctToPips`,
    // below) but kept this percentage as the source of truth.
    it('confidencePct: radar reads full unless trace, forecast reads probability, disagreement costs 20pp', () => {
      expect(confidencePct(true, false, 40, false)).toBe(100)  // radar-zone, measured: ignores prob/agree
      expect(confidencePct(true, true, 40, false)).toBe(70)    // radar-zone, but an unconfirmed trace echo
      expect(confidencePct(false, false, 100, true)).toBe(100)
      expect(confidencePct(false, false, 40, true)).toBe(40)
      expect(confidencePct(false, false, 40, false)).toBe(20)  // disagreement, floored at 20
      expect(confidencePct(false, true, 40, true)).toBe(20)    // forecast-zone trace reads low
      expect(confidencePct(false, false, null, true)).toBe(40) // beyond the probability horizon
    })

    // The readout renders the confidence pip bar (plus its small "confidence"
    // caption, v2.39.3) and, in the radar zone, reads full — the one thing
    // this test can assert without a DOM (renderToStaticMarkup can't fire a
    // scroll event, so it only ever reads slot 0, i.e. "now", which is
    // always radar). The old per-case source strings ("radar is clear" etc.)
    // are gone — the readout now just names the instrument ("Radar"), and
    // the pip bar carries the rest.
    it('the scrub readout reads dry/clear at rest, with full confidence', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).toContain(esc(t('ro_status_dry')))
      expect(html).toContain(esc(t('ro_src_radar')))
      expect(html).toContain(esc(t('ro_confidence_label')))
      expect(html).toContain(esc(t('ro_confidence', { n: 5 })))
      expect(html).toContain(esc(t('ro_back_now')))
    })

    // v2.38 — faint drizzle gets a mist marker (`.gr-mist`), never a taller
    // bar: the whole point of the redesign is that trace can't be mistaken
    // for confirmed rain just because it sits a few px taller.
    it('renders a mist marker for a trace-only reading, and none for plain dry', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const traceHtml = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map((_, i) => (i === 1 ? 0.05 : 0)), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="dark" t={t} unstable={false} modelRainMin={null} />)
      expect(traceHtml).toContain('gr-mist')
      const dryHtml = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="dark" t={t} unstable={false} modelRainMin={null} />)
      expect(dryHtml).not.toContain('gr-mist')
    })

    // v2.38 — the floating dry/trace overlay sentence is now suppressed
    // whenever the dry-window bracket already covers the same stretch AND
    // there is nothing forward-looking left to add (no incoming-rain
    // countdown, no instability flag). A live report called the pair
    // "redundant" once the mist marker existed alongside both. The overlay
    // still earns its place when it has something the bracket can't say.
    it('drops the redundant floating dry sentence once the bracket already covers it', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const dryForecast = { times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 2.66 * 3600 }
      const suppressed = renderToStaticMarkup(
        <RainRibbon forecast={dryForecast} theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(suppressed).not.toContain(esc(t('ribbon_dry')))
      // …but a real forward-looking claim (rain expected later) still shows,
      // bracket or not — the bracket only ever says "dry so far", never
      // "rain's coming", so that sentence still earns its place.
      const stillShown = renderToStaticMarkup(
        <RainRibbon forecast={dryForecast} theme="light" t={t} unstable={false} modelRainMin={45} />)
      expect(stillShown).toContain(esc(t('ribbon_dry_model', { min: 45 })))
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
                       'guide_days_2', 'guide_ribbon_5', 'guide_ribbon_6',
                       'src_daily']) {
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

    // v2.35 — the sky facts render inside the verdict block now. Same four values,
    // one section fewer; a mis-plumbed prop here would show as nothing at all.
    it('GapBanner carries the sky facts when given weather', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry', weather: null }
      const html = renderToStaticMarkup(
        <GapBanner status={status} blocked={[]} weather={{ code: 3, temp: 19.4, wind: 11.2 }} t={t} />)
      expect(html).toContain(esc(t('wx_cloudy')))
      expect(html).toContain('19°')
      expect(html).toContain('11 km/h')
      // …and nothing breaks when there is no weather yet, which is every first paint.
      expect(() => renderToStaticMarkup(
        <GapBanner status={status} blocked={[]} t={t} />)).not.toThrow()
    })
  })
}

// v2.35 — the dry-window bracket, as a contract rather than as pixels. The drawing
// itself lives on the canvas and cannot be asserted from here, but the rule that
// decides WHETHER a span is claimed is pure, and it is the half that can lie.
describe('dryRunIn (the dry-window bracket)', () => {
  const bars = ps => ps.map((p, i) => ({ t: i * 1800, end: (i + 1) * 1800, p }))

  it('finds the longest sub-threshold run', () => {
    // dry(2) · wet · dry(3) — the second run wins on length, not on being first.
    expect(dryRunIn(bars([0, 0, 0.8, 0, 0, 0]), 5)).toEqual({ a: 3, b: 5 })
  })

  it('never looks past the radar zone', () => {
    // Bars 2-5 are dry, but only bar 2 is inside the zone, so there is no run to
    // claim. Drawing across model bars would promise a window on evidence the
    // verdict itself declines to act on (v2.30.1's refusal rule).
    expect(dryRunIn(bars([0.8, 0.8, 0, 0, 0, 0]), 2)).toBeNull()
    expect(dryRunIn(bars([0.8, 0, 0, 0, 0, 0]), 2)).toEqual({ a: 1, b: 2 })
  })

  it('refuses a run shorter than MIN_BRACKET_BARS', () => {
    expect(MIN_BRACKET_BARS).toBe(2)
    expect(dryRunIn(bars([0.8, 0, 0.8, 0, 0.8]), 4)).toBeNull()
  })

  it('uses the same DRY_THRESHOLD as the rest of the app', () => {
    // 0.09 is dry, 0.1 is not — the one line every other threshold is measured from.
    expect(dryRunIn(bars([0.09, 0.09]), 1)).toEqual({ a: 0, b: 1 })
    expect(dryRunIn(bars([0.1, 0.1]), 1)).toBeNull()
  })

  it('claims nothing on an empty or out-of-range series', () => {
    expect(dryRunIn([], 5)).toBeNull()
    expect(dryRunIn(bars([0, 0, 0]), -1)).toBeNull()
    expect(dryRunIn(undefined, 3)).toBeNull()
  })
})

// v2.39 — 15-min buckets inside the radar zone, 30-min beyond it. Caught live
// (a flaky render test, not assumed from the code): a model-zone slot's
// floor(t/1800)*1800 can land on the EXACT SAME number as an unrelated PRIOR
// radar-zone slot's floor(t/900)*900 — pure coincidence of the two divisors —
// and the first cut's merge check (`cur.t !== start` alone) treated that as
// "still the same bucket", silently swallowing a model-zone slot into a radar
// bucket without ever extending its `end`. This is the regression pin: the
// exact real timestamps a scan across every possible "now" first caught it at.
describe('bucketMixed (mixed 15/30-min bucketing)', () => {
  // Aligned to a 1800s boundary so `t0` itself is a valid bucket start under
  // EITHER bucket size — an arbitrary timestamp (e.g. a raw Date.now()) is
  // not, and asserting against one would just be testing this test's own
  // misalignment, not the function.
  const t0 = Math.floor(1700000000 / 1800) * 1800
  const raw = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ t: t0 + offset + i * 900, p: 0 }))

  it('keeps every raw slot as its own bucket inside the radar zone', () => {
    const slots = bucketMixed(raw(10), t0 + 999999)  // radarUntil far past every slot
    expect(slots).toHaveLength(10)
    expect(slots[0]).toMatchObject({ t: t0, end: t0 + 900 })
  })

  it('merges pairs of raw slots into 30-min buckets beyond the radar zone', () => {
    const slots = bucketMixed(raw(4), t0 - 1)  // radarUntil before every slot → all model-zone
    expect(slots).toHaveLength(2)
    expect(slots[0].end - slots[0].t).toBe(1800)
  })

  it('never silently swallows a model-zone slot whose floored start collides with a prior radar bucket', () => {
    // The exact case found live: slot 11 sits just past radarUntil, and its
    // 30-min floor happens to equal slot 10's 15-min floor. A correct
    // implementation still produces 12 distinct buckets, the last one 30 min
    // wide; the bug produced 11, with the 12th slot's time silently dropped.
    const radarUntil = t0 + 2.66 * 3600
    const slots = bucketMixed(raw(12), radarUntil)
    expect(slots).toHaveLength(12)
    const last = slots[slots.length - 1]
    expect(last.end - last.t).toBe(1800)
    expect(last.end).toBeGreaterThan(radarUntil)  // the model-zone slot is actually represented
  })

  it('never loses the last raw slot, across every "now" phase (regression for the collision above)', () => {
    // The collision above wasn't tied to one specific "now" — real API data
    // (Open-Meteo/GeoSphere) always lands on quarter-hour marks, so `raw()`
    // stays 900s-aligned here (unlike the earlier drafts of this test, which
    // is why the offset varies `radarUntil` only, not the slot times
    // themselves). What actually varies from one real "now" to the next is
    // where THAT falls relative to the fixed quarter-hour grid — which is
    // exactly what shifts here. Symptom of the bug: the last raw slot's time
    // silently vanishing (folded into an earlier bucket without extending
    // it). The bucket count alone isn't a safe invariant (a legitimately
    // shorter/longer model tail can shift it by one) — full coverage is: the
    // final bucket must reach at least as far as the final raw slot's own
    // natural end.
    const slots0 = raw(12)
    const lastRawEnd = slots0[slots0.length - 1].t + 900
    for (let offset = 0; offset < 3600; offset += 137) {
      const radarUntil = t0 + offset + 2.66 * 3600
      const slots = bucketMixed(slots0, radarUntil)
      expect(slots[slots.length - 1].end).toBeGreaterThanOrEqual(lastRawEnd)
    }
  })
})
