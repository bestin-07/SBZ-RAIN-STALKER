import { useRef, useState } from 'react'
import { useFitText } from '../useFitText'
import { SkyGlance } from './Header'
import { formatClock } from '../time'
import { RV_HEAVY_MM } from '../gaps'

const ACTIVITY_EMOJI = {
  swim: '🏊', run: '🏃', bike: '🚴', moto: '🏍️', picnic: '🧺',
}

// The rotating sub-line variants (s_clear_hours etc., i18n.js) are written in
// the app's established casual sub-line voice — lowercase-first in English,
// same as every other s_*/n_* status string. That's fine as a sub-line; it
// reads wrong once GO promotes one into the HEADLINE slot ("dry for a good
// while, take your time" as the biggest text on screen). Capitalizes only
// the rendered headline, never the underlying string — the sub-line voice
// elsewhere (and every other language, where sentences already start
// capitalized) is untouched.
const capFirst = s => (typeof s === 'string' && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const COLORS = {
  go:      '#D4A017',
  light:   '#6CD1EB',
  wait:    '#1BAEE2',
  stuck:   '#0077AA',
  danger:  '#EF4444',
  loading: '#6B7280',
}

// The source line (v2.30). Three facts, no opinion: what the ground gauge reads,
// what the radar reads over your head, and when that was. `held` names the v2.22
// BLEIB DRIN hold, the one state where the verdict deliberately outlives the
// reading and therefore looks broken without a word of explanation.
//
// This is the cheapest trust the app can buy. Every hyper-local complaint in the
// logic log — "it is raining like hell and we say passt schon", "a sudden
// unreliable jump" — is a moment where the user could not see WHICH instrument was
// talking. A dry gauge printed next to a wet radar explains a GO ANYWAY in one
// glance; it does not change a single verdict.
//
// It reports only what was actually read: a lane with no reading says so (`—`)
// rather than borrowing the other lane's number.
//
// The radar lane is silent when it is CLEAR ("Radar frei") — that fact is
// already carried by the headline and the ribbon's dry-window bracket, and
// saying it a third time here was the exact redundancy a live UI review
// flagged ("dry" stated four times on one screen). A wet radar reading still
// prints (mm value) — that's the genuinely useful case, e.g. a dry gauge next
// to a wet radar, which is precisely what this line exists to explain.
export function SourceLine({ signals, t }) {
  if (!signals) return null
  const { ground, groundAt, radar, rv, updated } = signals
  const wet = v => typeof v === 'number' && v >= 0.1
  const dot = v => (v === null || v === undefined ? 'var(--c-muted)' : wet(v) ? 'var(--c-wait)' : 'var(--c-go)')
  // v2.46.0 — when the radar forecast's own slot is dry but the radar IMAGE over
  // your spot shows rain, the image is the witness behind the verdict. It's a
  // class, not a measurement, so it's named in words rather than given a fake mm.
  const rvOnly = !wet(radar) && wet(rv)
  // Truncate, don't round. Every threshold in gaps.js sits on a 0.1 boundary
  // (0.1/0.2/0.5/1.5) — a plain .toFixed(1) rounds e.g. gaugeSlotValue(0.1)
  // (0.15000...02, genuinely < LIGHT_MIN) up to the printed "0.2", which reads
  // as "the light-rain line was crossed" right next to a headline that stayed
  // gold because it wasn't. Flooring can only ever print LESS than the real
  // value, never more — so the number can't claim a boundary the verdict didn't.
  const mm = v => (Math.floor(v * 10) / 10).toFixed(1)
  const showRadar = typeof radar !== 'number' || wet(radar)
  // The gauge reading is a 10-min sum, published late and held for a 5-min cycle —
  // often 10–20 min old by the time it's on screen. Saying so is the honest version
  // of "ground 0.6 mm": the user can see why it may not match the sky right now.
  const groundAge = typeof groundAt === 'number'
    ? Math.max(1, Math.round((Date.now() / 1000 - groundAt) / 60)) : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-border">
      <span className="font-mono text-[10px] text-muted flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot(ground) }} />
        {typeof ground !== 'number' ? t('lane_ground_none')
          : groundAge != null ? t('lane_ground_age', { mm: mm(ground), min: groundAge })
          : t('lane_ground', { mm: mm(ground) })}
      </span>
      {rvOnly ? (
        <span className="font-mono text-[10px] text-muted flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot(rv) }} />
          {t(rv >= RV_HEAVY_MM ? 'lane_radar_rv_heavy' : 'lane_radar_rv')}
        </span>
      ) : showRadar && (
        <span className="font-mono text-[10px] text-muted flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot(radar) }} />
          {typeof radar !== 'number' ? t('lane_radar_none') : t('lane_radar', { mm: mm(radar) })}
        </span>
      )}
      {/* v2.48.1 — "confirming" (the v2.22 hold) is gone from this line: it showed
          whenever a hold record existed, even when the hold wasn't what made it
          STUCK, and the sentence under the headline already says "just confirming
          it holds" in the one case where that is actually happening. */}
      {updated && (
        <span className="font-mono text-[10px] text-muted ml-auto">
          {formatClock(updated)}
        </span>
      )}
    </div>
  )
}

// v2.48.1 — the source line moved behind this (maintainer: "too many writings"). The
// facts it shows are for the moment the verdict looks wrong; the rest of the time they
// were one more line of small print under the headline.
function InfoToggle({ open, onClick, t }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open}
            aria-label={t('lane_why')} title={t('lane_why')}
            className="inline-flex items-center justify-center align-middle w-5 h-5 ml-1.5 rounded-full border border-border
                       font-mono text-[10px] leading-none text-muted hover:text-primary hover:border-primary transition-colors">
      i
    </button>
  )
}

export default function GapBanner({ status, blocked = [], signals = null, weather = null, t }) {
  const [showWhy, setShowWhy] = useState(false)
  // v2.36.7 — must never wrap (see useFitText.js): Archivo's expanded cut is
  // wider than Space Grotesk, and any headline — "GEMMA RAUS", "BLEIB DRIN", a
  // countdown with an arbitrary minute count — can be long enough to wrap at
  // some viewport width. Hook is called before the early return below, since
  // hooks can't follow a conditional return.
  //
  // GO state only: `status.headline` is always the literal brand wordmark
  // (t('GO_NOW') === "GEMMA RAUS", see gaps.js) — identical to the header's
  // own title directly above this block. A live screen review flagged the
  // dry state as saying "dry" four times over; this is the biggest of the
  // four. Rather than repeat the brand name a second time, the descriptive
  // sub line ("dry for hours, take your time") takes the headline's slot —
  // every other state's headline (BLEIB DRIN / PASST SCHON / a countdown)
  // carries real information the header doesn't, so those are untouched.
  const isGo = status?.type === 'go'
  const headlineText = capFirst(isGo ? status?.sub : status?.headline)
  const headlineRef = useRef(null)
  useFitText(headlineRef, () => {
    const el = headlineRef.current
    const p = el?.parentElement
    if (!p) return 0
    const cs = getComputedStyle(p)
    // v2.48.1 — the row may also hold the ⓘ toggle (GO state): leave it room.
    let siblings = 0
    for (const c of p.children) if (c !== el) siblings += c.offsetWidth + 8
    return p.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - siblings
  }, [headlineText])

  if (!status) return null

  // Theme-aware colour via CSS var (light mode darkens these for contrast);
  // the hex from COLORS stays as a fallback if the var is ever missing.
  const fallback = COLORS[status.type] ?? COLORS.loading

  return (
    // v2.36.4 — py-6 (24px top AND bottom) was flagged live as wasted space on
    // both edges: 24px above SkyLine sat right under an alert banner that already
    // carries its own py-2.5, and 24px below the source line stacked with the
    // tab row's own pt-2.5 into a ~34px gap before the next visible thing. Trimmed
    // asymmetrically rather than just shrunk uniformly — the top keeps a touch
    // more room since it's the transition into the headline, the bottom needs
    // less since the tab row's own padding already does some of that work.
    <div className="px-4 pt-4 pb-3 shrink-0">
      {/* v2.35 — the sky facts, folded in from what used to be a bordered section
          of its own directly above. Muted and small: this is context for the
          headline, not a competitor to it.
          v2.38.5 — hidden on the Coming Days tab (App.jsx passes showSky=false
          there): "Cloudy 16°" describes right now, which reads as noise next
          to a block that's entirely about later days. The verdict itself
          (headline/sub/source line below) still stays — that's not tied to
          a particular hour the way the sky glance is. */}
      {/* v2.48.1 — the sky chip row is gone: its word repeated the headline, and the
          glyph + temperature now sit in the header (Header.jsx). */}
      {/* v2.38 — capped from text-5xl (48px): a live report showed the
          headline running almost edge-to-edge on an ordinary phone width,
          which read as oversized rather than confident. text-4xl (36px)
          keeps it the clear focal point of the block without dominating
          the screen; useFitText (above) still shrinks further only if an
          unusually long headline still doesn't fit at this base size.
          GO state (see isGo above) keeps the tagline at roughly its own
          former sub-line size — one step up (text-sm → text-base) rather
          than jumping to the display-sized brand treatment, so removing the
          brand-duplicate headline doesn't turn into a redesign of the block. */}
      <div className="flex items-center min-w-0">
        <div
          ref={headlineRef}
          // min-w-0: a transform-scaled headline still occupies its UNSCALED width in
          // the layout, which pushed the phone sky glance off the edge; letting the box
          // shrink keeps the row inside the screen (the fit scale keeps the text whole).
          className={isGo
            ? 'min-w-0 font-mono font-bold text-base leading-snug tracking-tight'
            : 'min-w-0 font-display font-bold text-4xl leading-none tracking-tight'}
          style={{ color: `var(--c-${status.type}, ${fallback})` }}
        >
          {headlineText}
        </div>
        {isGo && signals && <InfoToggle open={showWhy} onClick={() => setShowWhy(v => !v)} t={t} />}
        {/* Phones only — the header carries it from `sm` up (see Header.SkyGlance). */}
        <SkyGlance weather={weather} compact className="flex sm:hidden ml-auto pl-3 shrink-0" />
      </div>
      {!isGo && (
        <div className="font-mono text-sm text-muted mt-2 leading-snug">
          {status.sub}
          {signals && <InfoToggle open={showWhy} onClick={() => setShowWhy(v => !v)} t={t} />}
        </div>
      )}
      {/* What the weather has taken off the table. An EMPTY row is the good news —
          on a clear day nothing renders here at all. Each icon carries its own
          label, so a screen reader hears "no swimming" rather than a bare emoji.
          (The old row listed what you COULD do, with hardcoded English labels.) */}
      {blocked.length > 0 && (
        <div className="flex items-center gap-2 mt-2 leading-none">
          {blocked.map(a => (
            <span
              key={a}
              className="gr-no"
              role="img"
              title={t ? t('no_' + a) : a}
              aria-label={t ? t('no_' + a) : a}
            >
              <span aria-hidden="true">{ACTIVITY_EMOJI[a]}</span>
            </span>
          ))}
        </div>
      )}
      {status.weather && (
        <div className="font-mono text-xs text-muted mt-1 leading-snug">
          {status.weather}
        </div>
      )}
      {showWhy && <SourceLine signals={signals} t={t} />}
    </div>
  )
}
