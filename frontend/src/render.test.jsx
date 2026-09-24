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
import Header from './components/Header'
import DayStrip from './components/DayStrip'
import GapBanner, { SourceLine } from './components/GapBanner'
import RainRibbon, { dryRunIn, MIN_BRACKET_BARS, confidencePct, bucketMixed, drySkyVariant } from './components/RainRibbon'
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

    // v2.48.1 — the sky chip row is gone; its glyph, temperature and wind live in the
    // header. No condition WORD at all: the headline answers "is it raining on me".
    const header = (weather, lastUpdated = null) => renderToStaticMarkup(
      <Header weather={weather} lastUpdated={lastUpdated} theme="light" lang={lang}
              notifyState="unsupported" t={t} onThemeToggle={() => {}} onLangToggle={() => {}} onInfo={() => {}} onLogo={() => {}} />)

    it('the header carries the sky glance: glyph, temperature, wind', () => {
      const html = header({ code: 3, temp: 19.4, wind: 11.2 })
      expect(html).toContain('19°')
      expect(html).toContain('11 km/h')
      expect(html).toContain('<svg')
    })

    it('the header names no weather condition, for any code', () => {
      for (const code of [0, 3, 45, 53, 61, 73, 81, 95]) {
        const html = header({ code, temp: 14, wind: 8 })
        for (const k of ['wx_clear', 'wx_cloudy', 'wx_rain', 'wx_drizzle', 'wx_showers', 'wx_snow', 'wx_thunder', 'wx_fog']) {
          if (translations[lang][k]) expect(html).not.toContain('>' + esc(t(k)) + '<')
        }
      }
    })

    it('the header time is marked as the LAST UPDATE, not a clock', () => {
      const html = header(null, new Date('2026-09-24T13:27:00+02:00'))
      expect(html).toContain('↻')
      expect(html).toContain(esc(t('updated_at', { time: '' })).trim().slice(0, 8))
    })

    // v2.46.0 — one word per rain band across the screen: the ribbon readout and
    // the map popup used to call the 0.2–0.5 band "Light rain" and "Light drizzle".
    it('ribbon and popup name the light band the same way', () => {
      expect(translations[lang].ro_status_light).toBe(translations[lang].n_light)
    })

    it('no weather → no sky glance in the header', () => {
      expect(header(null)).not.toContain('°')
      expect(header({ code: null, temp: null, wind: null })).not.toContain('°')
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

    // v2.39.5 — live report: the German hour axis above the day rows rendered
    // overlapping text. Root cause: `Intl.DateTimeFormat('de-AT', {hour:
    // '2-digit'})` appends a literal " Uhr" ("16 Uhr") that the English
    // locale doesn't ("16"), and the axis positions its four ticks at tight,
    // fixed percentage offsets sized for a bare 2-digit number — the extra
    // word overflowed into the next tick's position. Every tick must be a
    // short digit-only string in BOTH languages, and "Uhr" must not appear
    // anywhere in the axis row (the one place this bug could hide again).
    it('the hour axis above the day rows is digit-only in every language', () => {
      const html = renderToStaticMarkup(<DayStrip daily={daily()} theme="light" t={t} lang={lang} />)
      const axisRow = html.match(/aria-hidden="true">(.*?)<\/div>/)?.[1] ?? ''
      expect(axisRow).not.toContain('Uhr')
      const ticks = [...axisRow.matchAll(/tabular-nums">(\d+)</g)].map(m => m[1])
      expect(ticks.length).toBeGreaterThan(0)
      for (const tick of ticks) expect(tick).toMatch(/^\d{1,2}$/)
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
      // v3.2 — the source label now sits beside a decorative SourceIcon svg,
      // so its own span carries only "font-mono text-xs text-primary" (the
      // "shrink-0" moved to the wrapping span that holds icon + label).
      const srcLine = html => html.match(/font-mono text-xs text-primary">([^<]*)<\/span>/)?.[1]
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
    // INTENT CHANGE (v2.48.1, maintainer: "too many writings"): no legend row under
    // the ribbon at all — the guide (?) explains the dot and the ring. The old chip
    // keys are gone; legend_trace stays only because the guide labels its example.
    it('draws no legend under the ribbon at rest', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{
          times, precips: times.map((_, i) => [0.05, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][i]),
          modelAgree: times.map((_, i) => i !== 1),
          isNowcast: true, radarUntil: now + 300,
        }} theme="light" t={t} unstable={false} modelRainMin={null} />)
      // Matched as a whole element: the (hidden) readout row may say "Faint drizzle
      // possible", which contains the legend's words.
      expect(html).not.toContain('>' + esc(t('legend_trace')) + '<')
      for (const k of ['legend_unsure', 'legend_bleed', 'legend_uncertain', 'lane_held']) {
        expect(translations[lang][k]).toBeUndefined()
      }
    })

    // v2.48.1 — a ring only where the drier model would draw a DIFFERENT tile. On a
    // showery day the two models differ by tenths on almost every tile; a ring on
    // every tile said nothing (live screenshot).
    // v2.48.1 — live screenshot: a bright gold sun on a dry 15-min gap inside a
    // rainstorm, while the sky said "Cloudy" for the same code.
    it('a dry tile draws a sun/moon only under a clear or partly clear code', () => {
      const noon = Math.floor(new Date('2026-09-24T13:00:00+02:00').getTime() / 1000)
      for (const code of [0, 1, 2]) expect(drySkyVariant(noon, code, noon - 6 * 3600, noon + 6 * 3600)).toBe('sun')
      expect(drySkyVariant(noon, 1, noon - 12 * 3600, noon - 1)).toBe('moon')
      for (const code of [3, 45, 53, 61, 63, 73, 81, 95, null]) {
        expect(drySkyVariant(noon, code, noon - 6 * 3600, noon + 6 * 3600)).toBe('cloud')
      }
    })

    it('rings a forecast tile only when the other model would draw a different tile', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const rings = low => {
        const html = renderToStaticMarkup(
          <RainRibbon forecast={{
            times, precips: times.map((_, i) => (i === 4 ? 0.3 : 0)),
            modelAgree: times.map((_, i) => i !== 4),
            modelLow: times.map((_, i) => (i === 4 ? low : null)),
            isNowcast: true, radarUntil: now + 300,
          }} theme="light" t={t} unstable={false} modelRainMin={null} />)
        return (html.match(/-right-1 w-2\.5/g) || []).length
      }
      expect(rings(0.25)).toBe(0)   // both models say drizzle: same tile, no ring
      expect(rings(0.02)).toBe(1)   // the other model says dry: a different tile, ring
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
      expect(confidencePct(false, false, 100, true)).toBe(100) // isDry omitted → defaults false, unchanged
      expect(confidencePct(false, false, 40, true)).toBe(40)
      expect(confidencePct(false, false, 40, false)).toBe(20)  // disagreement, floored at 20
      expect(confidencePct(false, true, 40, true)).toBe(20)    // forecast-zone trace reads low
      expect(confidencePct(false, false, null, true)).toBe(40) // beyond the probability horizon
    })

    // Live bug (2026-09-18): /api/ambient showed pprob 0-3% at every one of the
    // 11 points on a bone-dry day, and confidencePct used to read that number
    // DIRECTLY as confidence — so the most confident-dry forecast possible
    // showed the LOWEST bar on the chart. isDry flips which side of `prob` is
    // "confidence in the claim": a low rain-chance is high confidence in a DRY
    // tile, and only low confidence in a WET one.
    it('confidencePct: a dry tile reads confidence from (100 - prob), not prob', () => {
      expect(confidencePct(false, false, 3, true, true)).toBe(97)   // 3% rain chance, dry tile → very confident
      expect(confidencePct(false, false, 0, true, true)).toBe(100)
      expect(confidencePct(false, false, 90, true, true)).toBe(20)  // 90% rain chance but tile says dry → floored, unsure
      expect(confidencePct(false, false, 70, true, false)).toBe(70) // wet tile: unchanged, still reads prob directly
    })

    // The readout renders the confidence pip bar (plus its small "confidence"
    // caption, v2.39.3) and, in the radar zone, reads full — the one thing
    // this test can assert without a DOM (renderToStaticMarkup can't fire a
    // scroll event, so it only ever reads slot 0, i.e. "now", which is
    // always radar). The old per-case source strings ("radar is clear" etc.)
    // are gone — the readout now just names the instrument ("Radar"), and
    // the pip bar carries the rest.
    //
    // UI/a11y pass: "Trocken" at rest is dropped from the readout — it was
    // the third of four separate "it's dry" statements stacked on one screen
    // (the promoted headline and the ribbon's dry-window bracket already say
    // it). The confidence block now also carries a visible "N/5" value
    // (not just the pip bar) and role="img" + one aria-label on the
    // container, so the value reaches assistive tech too.
    // v2.46.0 — INTENT CHANGE: at "now" the readout no longer speaks a status or a
    // confidence. Both restated the headline — in different words ("Light rain"
    // under "GO ANYWAY · light drizzle") — and radar-zone confidence at now is
    // always full. The headline owns "now"; the readout names only the time and
    // the instrument until you scrub (renderToStaticMarkup can't scroll, so these
    // tests only ever see slot 0 — the scrubbed half is covered by the pure
    // slotStatusKey/confidencePct contract tests).
    it('at rest, the readout names the time and instrument only — dry reading', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map(() => 0), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="light" t={t} unstable={false} modelRainMin={null} />)
      expect(html).not.toContain(esc(t('ro_status_dry')))
      expect(html).toContain(esc(t('ro_src_radar')))
      // v2.48.2 — the status/confidence row is always laid out (so the chart never
      // jumps when you start scrolling) but invisible and hidden from screen readers
      // at rest — still says nothing at "now".
      expect(html).toMatch(/h-5 invisible" aria-hidden="true"><span class="font-mono text-sm">/)
      // v2.48.1 — "back to now" only once you've scrolled away from now.
      expect(html).not.toContain(esc(t('ro_back_now')))
    })

    it('at rest, the readout names the time and instrument only — wet reading', () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 12 }, (_, i) => now + i * 900)
      const html = renderToStaticMarkup(
        <RainRibbon forecast={{ times, precips: times.map((_, i) => (i === 0 ? 0.6 : 0)), isNowcast: true, radarUntil: now + 2.66 * 3600 }}
                    theme="light" t={t} unstable={false} modelRainMin={null} />)
      // Asserted on the status element itself: "Rain"/"Regen" also occurs in the
      // ribbon's aria-label, so a bare substring check can't tell them apart.
      // At rest the status row is laid out but invisible (v2.48.2): its word sits inside
      // the hidden row, never as visible text.
      expect(html).toContain(`h-5 invisible" aria-hidden="true"><span class="font-mono text-sm">${esc(t('ro_status_rain'))}</span>`)
      expect(html).toContain(esc(t('ro_src_radar')))
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

    // UI pass: a CLEAR radar reading ("Radar frei") no longer prints — the
    // headline (now the promoted tagline, see below) and the ribbon's own
    // dry-window bracket already say "dry"; this line restating it a third
    // time was the exact four-times-over redundancy a live screen review
    // flagged. A ground fact always prints (it's never redundant — it's the
    // one genuinely measured value); a WET radar reading still prints too,
    // since that's the case this line exists to explain (e.g. a dry gauge
    // next to a wet radar).
    it('GapBanner source line prints ground always, radar only when wet', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry', weather: null }
      const dryHtml = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0, radar: 0, held: false, updated: Date.now() }} />)
      expect(dryHtml).toContain(t('lane_ground', { mm: '0.0' }))
      expect(dryHtml).not.toContain(t('lane_radar_clear'))

      const wetHtml = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0, radar: 0.4, held: false, updated: Date.now() }} />)
      expect(wetHtml).toContain(t('lane_radar', { mm: '0.4' }))
    })

    // Live report (2026-09-24): every gauge in the city read TAWES RR 0.1mm/10min,
    // gaugeSlotValue() rescales that to 0.15000000000000002 (v2.21.0's ×1.5 slot
    // conversion) — genuinely BELOW LIGHT_MIN (0.2), so the verdict correctly stays
    // GO/gold with the s_barely_drizzle wording. But the source line's old plain
    // `.toFixed(1)` ROUNDED that 0.15 up to the printed "0.2" — visually the exact
    // LIGHT_MIN boundary — right under a gold headline that hadn't crossed it. The
    // user read the number, not the color: "i felt it should be blue... still a good
    // drizzle". The number was lying, not the verdict. Every threshold in gaps.js
    // sits on a 0.1 boundary, so truncating (not rounding) the display guarantees a
    // printed value can never claim a boundary the verdict didn't actually cross.
    it('source line never rounds a sub-threshold reading up to look like it crossed a boundary', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'a touch of drizzle', weather: null }
      const html = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0.1 * 1.5, radar: 0, held: false, updated: Date.now() }} />)
      expect(html).toContain(t('lane_ground', { mm: '0.1' }))
      expect(html).not.toContain(t('lane_ground', { mm: '0.2' }))
    })

    // v2.45.0: the gauge reading is a 10-min sum, published late and held for a 5-min
    // cycle — "ground 0.6 mm" in Itzling on 2026-09-24 described a shower that had
    // already passed. The line now says how old the reading is when the backend
    // serves the gauge's own timestamp, and stays as before when it doesn't.
    it('source line shows how old the gauge reading is, when known', () => {
      const status = { type: 'wait', headline: 'NOCH 17 MIN', sub: 'x', weather: null }
      const nowS = Math.floor(Date.now() / 1000)
      const aged = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0.9, groundAt: nowS - 14 * 60, radar: 0, held: false, updated: Date.now() }} />)
      expect(aged).toContain(t('lane_ground_age', { mm: '0.9', min: 14 }))

      const unknown = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0.9, groundAt: null, radar: 0, held: false, updated: Date.now() }} />)
      expect(unknown).toContain(t('lane_ground', { mm: '0.9' }))
    })

    // v2.46.0 — live screen 2026-09-24 12:54: GO ANYWAY, and the evidence line said
    // only "ground 0.0 mm". The drizzle call came from the radar IMAGE over the user,
    // which the line never showed — the one fact printed contradicted the headline.
    it('source line names the radar image when it is the witness behind the verdict', () => {
      const status = { type: 'light', headline: 'PASST SCHON', sub: 'x', weather: null }
      const html = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0, radar: 0.02, rv: 0.3, held: false, updated: Date.now() }} />)
      expect(html).toContain(esc(t('lane_radar_rv')))
      const heavy = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0, radar: 0, rv: 0.8, held: false, updated: Date.now() }} />)
      expect(heavy).toContain(esc(t('lane_radar_rv_heavy')))
      // A wet radar-forecast slot keeps its measured mm; the image isn't mentioned.
      const both = renderToStaticMarkup(
        <SourceLine t={t} signals={{ ground: 0, radar: 0.4, rv: 0.3, held: false, updated: Date.now() }} />)
      expect(both).toContain(t('lane_radar', { mm: '0.4' }))
      expect(both).not.toContain(esc(t('lane_radar_rv')))
    })

    // The GO headline is the promoted tagline (status.sub), not a second
    // "GEMMA RAUS" repeating the header's own wordmark directly above it —
    // the biggest of the four "dry" restatements a live screen review found.
    // Every other state's headline (a countdown, BLEIB DRIN, …) carries
    // information the header doesn't, so only GO is affected.
    it('GapBanner promotes the tagline to the headline slot for GO, and drops the duplicate sub', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'Trocken für Stunden, lass dir Zeit', weather: null }
      const html = renderToStaticMarkup(<GapBanner status={status} blocked={[]} t={t} />)
      expect(html).toContain('Trocken für Stunden, lass dir Zeit')
      expect(html.match(/Trocken für Stunden, lass dir Zeit/g)).toHaveLength(1)
      expect(html).not.toContain('GEMMA RAUS')

      // A non-GO state is untouched: headline AND sub both still render.
      const stuck = { type: 'stuck', headline: 'BLEIB DRIN', sub: 'no break in sight', weather: null }
      const stuckHtml = renderToStaticMarkup(<GapBanner status={stuck} blocked={[]} t={t} />)
      expect(stuckHtml).toContain('BLEIB DRIN')
      expect(stuckHtml).toContain('no break in sight')
    })

    // Live report: "dry for a good while, take your time" rendered with a
    // lowercase d as the biggest text on screen. The rotating sub-line
    // variants (s_clear_hours etc.) are written lowercase-first on purpose —
    // that's the established sub-line voice — but once GO promotes one into
    // the HEADLINE slot it needs to read like a headline. Capitalized at the
    // render site only; the i18n string itself, and every other language
    // (German sentences already start capitalized), are untouched.
    it('capitalizes the promoted GO headline without touching the sub-line voice elsewhere', () => {
      const status = { type: 'go', headline: 'GEMMA RAUS', sub: 'dry for a good while, take your time', weather: null }
      const html = renderToStaticMarkup(<GapBanner status={status} blocked={[]} t={t} />)
      expect(html).toContain('Dry for a good while, take your time')
      expect(html).not.toContain('>dry for a good while')
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
      expect(() => header(null)).not.toThrow()
      expect(() => renderToStaticMarkup(<SourceLine signals={null} t={t} />)).not.toThrow()
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
                       'guide_days_2', 'guide_ribbon_1', 'guide_ribbon_4',
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

    // v2.48.1 — INTENT CHANGE: the source line sits behind an "i" next to the
    // sentence (maintainer: "too many writings"). By default only the toggle renders;
    // the readings appear on tap. And the banner no longer carries the sky chip.
    it('GapBanner shows the "i", not the readings, until tapped — and no sky chip', () => {
      for (const status of [
        { type: 'go', headline: 'GEMMA RAUS', sub: 'dry' },
        { type: 'stuck', headline: 'BLEIB DRIN', sub: 'no break in sight' },
      ]) {
        const html = renderToStaticMarkup(
          <GapBanner status={status} blocked={[]} t={t} signals={{ ground: 0.4, radar: 0.3, updated: Date.now() }} />)
        expect(html).toContain(`aria-label="${esc(t('lane_why'))}"`)
        expect(html).toContain('aria-expanded="false"')
        expect(html).not.toContain(esc(t('lane_ground', { mm: '0.4' })))
        expect(html).not.toContain('°')
      }
      // No readings at all → no toggle either.
      const bare = renderToStaticMarkup(<GapBanner status={{ type: 'go', headline: 'x', sub: 'dry' }} blocked={[]} t={t} />)
      expect(bare).not.toContain(esc(t('lane_why')))
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
