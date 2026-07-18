# Changelog

All notable, user- or logic-affecting changes to Gemma Raus. Newest first.
Versioning is [SemVer](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change or a full re-architecture.
- **MINOR** — a new feature or a behavioural change to the rain logic.
- **PATCH** — a bug fix or copy/UI tweak with no logic change.

Each release is tagged in git as `vMAJOR.MINOR.PATCH`. To roll back, redeploy the
previous tag (see CLAUDE.md → **Versioning & rollback**).

---

## [2.9.0] — 2026-07-18 — Gemma Raus just got better: at home on your iPhone 📱
*A round of iOS love — everything reported from an iPhone in one release, plus a proper front door.*

**What happened**
- On iOS the moving 12-hour ribbon sat frozen. Found it: iPhones round scroll
  positions to whole pixels, and our gentle drift moves less than a pixel per
  frame — so every tiny step got rounded straight back to zero. Desktop browsers
  keep fractions, which is why only iPhones froze. The ribbon now keeps its own
  precise position and only *tells* the screen where to be — it drifts on every
  device now. (If it still holds still for you: iPhone's "Reduce Motion" setting
  intentionally turns the auto-drift off — that part is by design, your finger
  still scrolls it.)
- On busy-weather days the warning banners (UV + wind + thunder + the big verdict)
  stacked taller than the screen — and the page had nowhere to scroll, so it just
  felt stuck and the map got squeezed away.

**What's new for you**
- **The page always scrolls now.** Banners can pile as high as the weather wants —
  you scroll through them, and the map always keeps a usable size at the bottom.
- **Tap GEMMA RAUS to go home.** The logo in the top-left now takes you back to
  the start page. Your saved spot isn't lost — one tap on GET MY LOCATION brings
  you right back.
- **The ribbon glides on iPhones** — and it no longer leaps to the far end when
  you return to a backgrounded tab.
- **Bottom sheets fit the *visible* screen.** The guide and privacy sheets used to
  tuck their last lines behind Safari's toolbar; they now size themselves to what
  you can actually see, and scrolling inside them no longer drags the page behind.
- **Older iPhones (iOS 15 and earlier) load again.** They're missing a browser
  timer feature every data call relied on — we now bring our own.
- The start screen scrolls on small phones instead of clipping the location-help
  text, and the iOS rubber-band no longer yanks the whole app around.

Nothing about the rain logic changed — same verdicts, same countdowns, same radar.

---

## [2.8.0] — 2026-07-17 — Gemma Raus just got better: no phantom drizzle on a cloudless day ☀️
*You looked at a perfect blue sky, the app said "drizzle possible" for three hours straight, and you asked us to cross-check. You were right.*

**What happened**
- On a cloudless 30° afternoon the radar timeline painted an identical whisper of
  drizzle across **all eleven city points** — same minute, same tiny value. Real
  drizzle never does that. We checked the live radar picture: **not a single echo
  within ~275 km**, and the airport reported zero clouds. That whisper was the
  nowcast model's own background noise, not weather.

**What's new for you**
- **Two witnesses now get a veto on "drizzle possible".** When the sky over you is
  clear AND the live radar picture is completely quiet — nothing at your pixel,
  nothing approaching, nothing in the ~15 km ring — the drizzle-possible wording
  stands down and the ribbon's trace stubs fade to a faint watermark. Blue sky
  overhead now means the app agrees with your eyes.
- **Your exact worry is the built-in safety case:** rain that's genuinely coming
  shows up on the live radar long before any cloud reaches your sky — so the veto
  releases itself the moment anything real appears, from either witness. Pop-up
  summer cells build visible towers first, which also releases it. And if the live
  radar feed is unavailable, we can't corroborate — so we never suppress.
- Nothing else changes: real rain bars, downpour warnings, approach directions and
  every countdown are untouched. This only silences the faintest tier when both
  independent instruments say it isn't there. Bonus: on a genuinely perfect day the
  friendly "go out" notes come back instead of being blocked by phantom drizzle.

**Why this direction**
- Our standing rule is "better a lead than a lag" — but this wasn't a lead, it was
  three hours of crying wolf against both instruments and your own eyes. Trust is
  the product too.

---

## [2.7.0] — 2026-07-17 — Gemma Raus just got better: two forecasts, one honest answer 🌧🌧
*You asked whether radar can see past 3 hours. It can't — nobody's can — but this is the next best thing.*

**What's new for you**
- **The forecast zone now runs on TWO models, not one.** Alongside the global
  Open-Meteo blend, we now pull GeoSphere's own AROME model — the 2.5 km Alpine
  model that **assimilates the Austrian radar network**, re-run every 3 hours.
  The rule is simple and safe: **whichever model shows rain is displayed, and the
  stronger value wins**, slot by slot. Two forecasts have to BOTH miss for the
  ribbon's forecast zone to stay wrongly blank.
- This feeds everything, not just the picture: the "radar clear so far — model
  expects rain in ~X h" second opinion, the ghost bars inside the radar zone, and
  the STUCK-side "model expects easing" line all read the combined lane, so the
  wording always matches what the ribbon paints.

**Why this direction**
- Our standing rule: you'll forgive us for painting rain that fizzles, not for a
  blank ribbon before real rain. A union of two independent models can only add
  warnings, never hide one.

**Under the hood (for the curious)**
- Backend fetches AROME (`nwp-v1-1h-2500m`) per grid point, cached 30 min (the
  model only re-runs 3-hourly) — about 22 extra GeoSphere calls/hour against the
  ~130 the nowcast already makes, far from the rate-limit incident territory. The
  precip parameter is discovered at runtime from the dataset's own metadata
  (per-interval `rr`, else accumulated `rr_acc` + de-accumulation) so a schema
  surprise degrades to "no AROME" instead of an outage.
- New pure `combineModelSeries`: per-slot max, AROME hourly totals scaled to slot
  width; an AROME timestamp is treated as the END of its accumulation hour — if
  that convention is ever wrong, rain paints an hour EARLY (a lead), never late.
- 6 + 4 new contract tests (162 total: 142 frontend + 20 backend). Fails soft
  everywhere: no AROME on the snapshot → exactly yesterday's behaviour.

---

## [2.6.0] — 2026-07-17 — Gemma Raus just got better: no more mixed messages 🧭
*Thank you for the sharp-eyed feedback on readability — three small things that each made the app say one clear thing instead of two conflicting ones.*

**What's new for you**
- **Zone band over the ribbon:** a thin labelled strip now sits above the rain bars —
  **RADAR · NEXT 3 H** over the solid look-ahead zone, **FORECAST · MODEL** over the
  dashed estimate zone. The solid→dashed switch finally explains itself; no more
  guessing where observation ends and estimate begins. (And no, nobody's radar sees
  further than ~3 h — beyond that, everyone's timeline is a model, including the big
  weather sites. We just label it honestly.)
- **No more "suspiciously perfect" under a drizzle countdown:** when ANY radar signal
  has rain in sight — drizzle ahead, echo nearby, rain approaching — the cheerful
  "go before the sky changes its mind" invitation notes now stay quiet instead of
  contradicting the countdown right below them.
- **Compass on the map:** a small N/E/S/W rose (N/O/S/W auf Deutsch) in the corner,
  so "rain approaching from the northwest" finally points somewhere you can see.

**Under the hood (for the curious)**
- The comfort-note gate (`rainSoon`) now includes every rain-in-sight trend signal
  (`downpourSoonMin`, `rvApproachMin`, `rvNearbyDir`, `traceEcho`, `traceAheadMin`),
  not just a hard `nextRainAt` within 90 min. Suppression only — it can never ADD an
  invitation, and prep notes (wind/cold) still show. Verdicts untouched.
- Ribbon canvas grew a 14 px zone band; the model-only fallback timeline draws the
  whole band as FORECAST (never claims a radar zone it doesn't have). 9 new contract
  tests (152 total: 136 + 16).

---

## [2.5.0] — 2026-07-17 — Gemma Raus just got better: it now foresees drizzle, not just rain 🔮
*Follow-up to today's drizzle incident: catching it live wasn't enough — you should have seen it coming.*

**What's new for you**
- **Drizzle countdowns:** when the radar's own timeline shows faint sub-threshold
  echo starting later ("drops on your face" level, under our 0.1 mm reporting line),
  the app now says so — *"light drizzle possible in about 30 min — radar shows the
  first faint echoes"* — instead of claiming "clear for hours".
- **Drizzle in the ribbon:** trace-level slots now draw as low translucent stubs (new
  "drizzle possible" legend entry), so the next hours never look blank while faint
  echo is on the way. An all-trace ribbon says *"only faint drizzle traces on radar —
  nothing heavier in sight"* instead of "no rain in 3h".

**Why**
- Live incident, same day as v2.4.1: while it drizzled, our nowcast *did* show the
  field continuing as 0.01 mm slots an hour ahead — the exact signal wetter.com was
  painting as "light until 13:00" — but everything below the reporting cutoff
  rendered as "nothing coming". We had the foresight and hid it.

**Under the hood (for the curious)**
- New pure `traceAheadMin(times, precips, nowSec)`: minutes until the first RUN of
  ≥2 consecutive trace slots (0 < mm < 0.1) within the 3 h radar window — a single
  0.01 noise blip can never paint drizzle on a dry day.
- New wording tier in the GO branch, radar-trace beats model-guess: approach ETA and
  nearby-watch (observed echo NOW) outrank it; it outranks the model second-opinion;
  real ≥0.1 mm countdowns are untouched; quiet at night. **No state changes** — trace
  futures are wording + ribbon only, they can never create a WAIT/STUCK.
- Verified against live data: the two still-dry grid points got "drizzle possible in
  ~13/~28 min" from the real feed. 15 new contract tests (143 total: 127 + 16).

---

## [2.4.1] — 2026-07-17 — Gemma Raus just got better: drizzle can't hide anymore 🌦
*Thank you for the live report — a real drizzle the app called "dry" is exactly the bug we care most about.*

**What happened**
- It was drizzling over Salzburg while every one of our usual sources read zero: the
  gauge (drizzle accumulates too slowly per interval), the radar nowcast's current
  slot (it lagged the fresh field by ~1 h), the model (flat 0.00 for 12 h) and the
  sky code (plain "overcast"). RainViewer's live radar tile was the **only witness**
  — echo blooming right over the city — and the v2.2.1 clutter guard vetoed it,
  because that guard required a nowcast trace as corroboration. Result: "totally
  dry" during real drizzle — the exact direction of mistake we promised to avoid.

**The fix**
- A lone stuck clutter pixel and a drizzle *field* look nothing alike on the radar
  tile. The sampler now counts wet pixels across the ~6×6 km block around your spot
  (the live incident: 24 of 25 wet; the old Nonntal clutter pixel: 1–2). Wide
  coverage (≥ 40 % of the block) now counts as corroboration on its own — RainViewer
  vouching for itself with spatial extent, under a non-clear sky.
- **All previous protections stay:** a clear sky still vetoes RV-only claims
  absolutely (sunny clutter/anaprop), a lone pixel with zero radar trace stays
  suppressed (the v2.2.1 incident replayed in tests, still dead), and the surfaced
  value stays capped to the light "GO ANYWAY — jacket" band — this can never
  manufacture a WAIT/STUCK.
- 6 new contract tests (128 total: 112 frontend + 16 backend), including a replay of
  today's exact incident. Zero extra network cost — same tile, more pixels read.

---

## [2.4.0] — 2026-07-17 — Gemma Raus just got better: it now sees which way the rain moves 🧭
*Thank you for being an early user and sharing feedback — that's exactly what makes this app better.*

**What's new for you**
- **Rain direction:** when rain is nearby, Gemma Raus now tells you *where* it is —
  "rain on the radar to the **west** — keeping an eye on it" — and when it's headed
  your way: "rain moving in **from the west** — about 20 min out".
- **City-scale picture:** a quiet new line shows where over Salzburg it's raining and
  which way it's going — "rain over the west of Salzburg — spreading" / "pulling back".
- All of this uses radar we already display — **observed** echo, not guesses.

**Under the hood (for the curious)**
- The RainViewer pixel sampler now reads an 8-point compass ring ~15 km around your
  spot **off the same tile** (zero extra network) → approach/nearby direction via a
  vector-summed dominant sector (`ringDirection`, opposite sectors cancel to "no
  coherent direction"). Direction enriches the existing approach ETA; a new
  "nearby, watching" tier fires when echo sits in a coherent sector with no arrival
  ETA yet — observed echo outranks the forecast hint, yields to trace drizzle at the
  pixel and to any arrival ETA, and stays quiet at night.
- The backend compares wet vs dry centroids across its 11 grid points each cycle
  (cos-corrected bearing) + wet-count trend → `area_watch {sector, trend}` on
  `/api/ambient`, shown as a muted banner when the grid is partially wet (fresh ≤10 min).
- 27 new contract tests (122 total: 106 frontend + 16 backend). No existing verdict
  logic changed — the new tiers only *add* information where the app used to be silent.

---

## [2.3.1] — 2026-07-17 — Human wording (confidence, not instruments) + visible forecast bars
### Changed (copy + ribbon visuals, no logic change)
- All "model" jargon replaced with plain confidence language: *"first signs: rain
  possible in about 1½ h — nothing on radar yet"* (was "model expects rain…"),
  *"should ease in about 2 h"* (was "model expects easing…"), forecast/Prognose in the
  legend and labels. Certainty is now carried by the words themselves — "first signs /
  possible / could / should" for forecast-only claims, firm phrasing for
  radar-confirmed ones — instead of asking users to know what a "model" is.
- Ghost/forecast bars in the ribbon now have a faint translucent fill (not just a
  dashed outline) — visible as real bars at a glance while staying clearly distinct
  from solid radar bars.

---

## [2.3.0] — 2026-07-17 — Acknowledge trace drizzle below our reporting cutoff
### Added (rain logic — wording only, GEMMA RAUS stays GEMMA RAUS)
- Live incident, Nonntal: it was genuinely (lightly) drizzling — every nearby grid
  point showed real, widespread radar echo of **0.01–0.06 mm**, all below our
  `DRY_THRESHOLD` (0.1 mm/15min) reporting cutoff. The app said flatly "clear for
  hours" / "rain in about 2½ h", implying total dryness when faint, real drizzle was
  happening right now. `DRY_THRESHOLD` is a reporting line, not a physical one.
- New `hasTraceEcho(rawNowSlot)`: when the radar's OWN 3h timeline is fully dry
  (`dryEndsOpen`) but its raw current-slot reading shows *any* non-zero trace below
  the cutoff, the GO sub now says so — combined with the model's own far-rain time
  when available: **"light drizzle on radar right now — steadier rain expected in
  about 2½ h"**. Standalone wording when no model rain data exists. Popup notices too.
- Policy: *better to nudge caution than stay silent about a signal we already have* —
  but this is wording-only. It does NOT flip GEMMA RAUS to GO ANYWAY (that requires
  `surfaceDrizzle`'s stricter, corroborated bar) and never touches WAIT/STUCK.
  Downpour warning and RV-approach still outrank it; night keeps the cosy drizzle
  voice instead. 10 new contract tests (95 total).

---

## [2.2.1] — 2026-07-17 — Fix the overcast-clutter bug (GO ANYWAY while genuinely dry)
### Fixed (rain logic)
- Live incident, Nonntal: gauge 0.0, radar nowcast an **exact 0.0 across the whole 3h
  window**, sky overcast (code 3) — yet a raw RainViewer pixel claimed echo, and the
  drizzle-surfacing guard (only blocking under a *clear* sky) let it through. The app
  said GO ANYWAY while it genuinely was not raining.
- `surfaceDrizzle` now requires **independent radar corroboration** for an RV-only
  claim: any non-zero nowcast trace (however small) near the pixel, not just "sky isn't
  clear". A flat, exact-zero radar reading is treated as active disagreement — real
  weather leaves *some* radar signature; a total absence, overcast or not, is clutter
  (terrain reflection off Untersberg/Gaisberg, or tile noise). "Sky unknown" no longer
  gets a free pass either. The original hyperlocal-drizzle catch this feature was built
  for is unaffected — that case already had a non-zero (near-threshold) radar trace.
  2 new / 4 updated contract tests (85 total).

---

## [2.2.0] — 2026-07-16 — Ribbon extended to 12h + mobile auto-scroll
### Added (ribbon UI)
- **Ribbon now spans 12h** (was 3h): radar covers the first ~3h as solid bars
  (unchanged, ground/radar-trusted); beyond that, the model's own 12h timeline fills
  the rest as **dashed outlined bars** — same visual language as the v2.1 ghost bars,
  so "this is an estimate, not radar precision" reads consistently across the whole
  chart. A subtle dashed divider + "model →" tag marks the handoff point. Zero extra
  API calls — the model timeline was already fetched for the ghost bars/second-opinions.
- **Auto-scroll for mobile**: the ribbon now slowly drifts forward (so all 12h become
  visible without manual scrolling), pauses briefly at the end, then rewinds quickly
  back to "now" and repeats. Self-gates to when the ribbon actually overflows the
  screen (desktop where it all fits does nothing), respects
  `prefers-reduced-motion` (disabled entirely), and pauses for 5s the instant the user
  touches/scrolls/wheels it — never fights a manual read.
- Ribbon label updated from "3h · Radar" to "12h · radar + model".

---

## [2.1.0] — 2026-07-16 — Model in the gaps: ghost bars + STUCK second-opinion
### Added (rain logic + ribbon)
- **Ghost bars:** model-only rain (radar slot dry, model slot wet) is now drawn in the
  ribbon as **dashed outlined bars** at the model's intensity, with a "model (expected)"
  legend chip — both instruments visible at a glance without faking radar precision.
  Only drawn when the solid bars are radar (in model-fallback mode the bars ARE the model).
- **STUCK second-opinion** (`modelEaseAt`): STUCK means "radar sees no break in 3 h" —
  if the model's own timeline shows the rain **ending**, the sub now says "no break on
  radar — **model expects easing in about 2 h**" (popup notice too). Wording only; the
  state and colour stay STUCK until radar confirms. Requires the model to actually show
  the rain first (a model that's dry all window contradicts the present → no claim).
  Thunderstorm wording still outranks it. Completes the design law on the STUCK side:
  *never claim what any of our own sources contradicts.* 8 new tests (83 total).

---

## [2.0.3] — 2026-07-16 — One-time trust note (owning the July 15 miss)
### Added (UI)
- A one-time, closable in-app note: *"On July 15 we missed the evening rain — we're
  sorry. The app now also cross-checks the weather model and the radar's motion, and
  warns when rain is expected even while the radar is still clear."* Shown once per
  device (localStorage `update_note_20260716`), dismissible, DE + EN. Owning the miss
  publicly + saying exactly what changed.

---

## [2.0.2] — 2026-07-16 — Map animation reaches the actual future
### Fixed (map UX)
- The radar timeline often ended in the past ("stops at 20:30 when it's 20:34"):
  RainViewer frames are 10-min quantized and generated ~5–10 min behind wall clock,
  and we kept only 2 of its 3 forecast frames — so the "future" frames were frequently
  already history. Now **all 3 forecast frames** are animated (loop reaches ~+20 min
  past wall clock) and **forecast frames dwell 2× longer**, so the loop reads
  "now → ahead" instead of a history reel. Frame set still refreshes every 5 min.

---

## [2.0.1] — 2026-07-14 — Trailing-edge fix: the model can't out-shout a reporting gauge
### Fixed (rain logic — the bogus "WAIT 50 MIN in the sun")
- Open-Meteo's `current.precipitation` is a **preceding-hour** value — after rain ends
  it stays high for up to an hour. The blend took `max(model 0.7, gauge 0.0) = 0.7` →
  a false WAIT/STUCK on every trailing edge while the sky was already clearing.
- New rule (`gaps.modelNowValue`, contract-tested): **a reporting gauge owns the NOW
  magnitude**; the hour-lagged model current is capped at the light band (**0.4**) —
  it may whisper "drizzle the gauge missed", it can never manufacture WAIT/STUCK alone.
  The 0.10-rounding guard is preserved; with no gauge at all the model passes through.
  Same cap philosophy as the virga filter. 4 new tests (75 total).

---

## [2.0.0] — 2026-07-14 — Full-frame radar approach: a real ETA, not a guess
### Changed (rain logic — refines the v1.4.0 approach guard)
- The RainViewer approach guard now samples **every** forecast frame (10-min steps,
  ~+10/+20/+30) instead of only the last one. Two wins: an **early-arriving cell
  (+10 min) is no longer missed** (previously invisible if it passed before the +30
  frame), and the verdict shows the **first-arrival ETA** — "rain approaching on radar
  — could reach you in about **10** min" — instead of a generic "~30 min".
- Tile cost unchanged in practice: every Salzburg point maps to the same z7 tile, so
  the browser caches per frame path across the live location and all dots.
- Versioned 2.0: with v1.4's model second-opinion + this, the forward view is now a
  true **multi-source architecture** (gauges → RainViewer now/approach → GeoSphere
  timeline → model second-opinion), each source used where it leads. 71 contract tests.

---

## [1.4.0] — 2026-07-14 — Fix the missed evening rain: two onset guards
**Post-mortem:** the app said dry all evening; rain came; other weather apps had it.
Root cause was architectural: the NEXT lane was **radar-nowcast-only**, and radar
extrapolation cannot see rain that doesn't exist as echo yet. For frontal/stratiform
onset the MODEL leads the radar by hours (the mirror of convection, where radar leads
the lagging model — we'd over-fit to that first lesson and discarded the model whenever
the radar answered). On top of that, GeoSphere's nowcast issues 15–25 min behind real
time, while RainViewer's frames run ~5 min behind — users could SEE the rain as blue on
our own map while the ribbon claimed dry.

### Added (rain logic — two new onset guards, radar still leads when it sees rain)
- **Model second-opinion** (`modelNextRainAt`): when the radar claims a full 3 h
  all-clear but the model's own minutely timeline shows rain, the verdict says
  "**radar clear so far — model expects rain in about X**" (minutes <90, hours ≥90),
  in the sub, the popup notice AND the ribbon dry-label. Never a confident all-clear
  the model contradicts: *better someone stays home dry.*
- **RainViewer approach guard** (`rvApproaching`): the pixel sampler now also reads the
  RainViewer FORECAST frame (~+20–30 min, observed echo motion). Pixel clear now + echo
  arriving + GeoSphere silent → "**rain approaching on radar — could reach you within
  ~30 min**". Moving echo can't be static clutter, so no clear-sky guard needed.
  Promotes what users can already see on the map into the verdict.
- Precedence: downpour warning > RV approach > model second-opinion > radar countdowns
  (a nearer GeoSphere countdown always wins over the approach guard). 9 new contract
  tests (70 frontend total).

---

## [1.3.1] — 2026-07-14 — Honest dry-ribbon label (attribution + instability)
### Changed (wording only)
- The all-dry ribbon label no longer reads as a promise. Default: "**radar sees** no
  rain in the next 3 h" (attributes the claim to the instrument). Under unstable air
  (CAPE ≥ 300): "radar sees no rain **yet — unstable air, can change fast**". CAPE
  alone gates the variant (no hour/probability filter — it's wording, not a banner).

---

## [1.3.0] — 2026-07-14 — Convective watch: CAPE flags the risk, radar confirms it
### Added (banners + one push — the verdict logic is untouched)
- **Layer 1 · "Unsettled" regime flag** (frontend, muted banner): CAPE ≥ 300 J/kg AND
  max hourly probability (next ~4 h) ≥ 50% during convective hours (11:00–20:00) →
  *"unsettled air — showers can form fast today, windows may be short."* Sets
  expectations on pop-up-shower days without contradicting GEMMA RAUS. Evidence-based
  thresholds: the soaking day (CAPE 200–570, prob 40–78%) flags; the sunny-clutter day
  (CAPE 90–330, prob 3–53%) doesn't. Suppressed when the ≥1500 storm banner is up.
- **Layer 2 · Radar-confirmed initiation** (backend): each cycle compares every grid
  point's "wet now" against the previous cycle; **≥3 points flipping dry→wet in one
  cycle + CAPE ≥ 300** = cells forming over the basin RIGHT NOW (observation, not
  speculation). Stamps `forming_ts` on `/api/ambient` → alert banner *"showers forming
  over Salzburg right now — any spot could get hit"* (visible 30 min, live-expiring) +
  a **once-per-day "forming" push** (top of the story order, daytime + pacing rules).
- 6 new frontend tests + 4 new backend tests (73 total).

---

## [1.2.1] — 2026-07-14 — Gap-confidence softener (symmetry with rain onset)
### Changed (wording only — times always kept)
- A break predicted **≥60 min out** is now spoken as "**break likely in about X min**" /
  "rain **should** end in about X min" (WAIT sub + popup notice); breaks under an hour
  stay firm. Time-based on purpose: verified nowcast skill is strong under 1 h and
  decays past it (POD ~50% at 60–90 min) — and the model's *hourly* probability stays
  high through a whole rainy spell, so a probability-based softener would have marked
  every intra-rain gap "likely" (over-softening). Mirrors the v1.2.0 far-rain rule:
  soften the wording, never delete the countdown. 3 new contract tests (55).

---

## [1.2.0] — 2026-07-14 — The countdown covers the FULL horizon (gaps-first)
### Changed (rain logic)
- **Far-out rain (≥90 min) now always gets an explicit countdown, in hours** — "GEMMA
  RAUS · rain in about 3 h". Previously the explicit countdown stopped at ~90 min:
  beyond that, low-confidence rain collapsed to a timeless "rain possible later" (and
  the reader saw the band in the ribbon with no matching words — the Nonntal 3 h case).
  Low model confidence now **softens the wording but keeps the time**: "rain possible
  in about 2 h". Rounded to the nearest half hour (1½ / 2 / 2½ / 3). Map-popup notices
  carry the same far countdown (`n_rain_far`).
- Philosophy made explicit: **the dry window is the product** — every state that knows
  when rain arrives says so, across the whole 3 h horizon. 4 new contract tests (52).

---

## [1.1.5] — 2026-07-14 — Clear-sky clutter guard (fix "sunny but PASST SCHON")
### Fixed
- On a sunny day the app showed **GO ANYWAY + light rain in the ribbon** while gauge,
  model (code 1 = sunny) and the filtered nowcast all read bone dry. The lone witness
  was the **raw RainViewer pixel** — raw radar tiles show ground clutter (mountain
  reflections, insects, anaprop) on clear days; the GeoSphere nowcast is
  clutter-filtered, RainViewer tiles are not.
- Drizzle surfacing extracted to a pure, tested function (`gaps.surfaceDrizzle`) with
  a **clear-sky clutter guard**: an RV-only echo cannot surface drizzle when the model
  says the sky is clear (code ≤ 2). Echo in the *filtered* nowcast still surfaces even
  under a clear sky (quality-controlled source), overcast/unknown sky still trusts RV
  (the real Nonntal drizzle case) — so the gauge-blind-drizzle catch is fully preserved.
- 7 new contract tests (48 total frontend).

---

## [1.1.4] — 2026-07-06 — CRITICAL: virga filter was hiding real downpours
### Fixed (regression, introduced in 1.1.0)
- The virga-filter "cap" rewrite accidentally applied to **all** low-probability echo —
  including a real 2–3 mm convective downpour. ICON-EU lags convection, so on pop-up
  shower days its probability stays <50% exactly when the radar sees a real cell: the
  filter capped the downpour to 0.4 mm → ribbon showed "light drizzle", the ≥1.5 mm
  downpour warning could never fire, and the verdict said GO ANYWAY into a soaking.
  (The backend's push analysis reads the raw timeline — that's why it correctly fired
  `rain_incoming` while the app showed dry: the app was served the filtered data.)
- **Heavy echo (≥1.5 mm) now always passes through unfiltered** — radar seeing heavy
  rain is self-evidencing; virga is light echo by nature. Light low-confidence echo is
  still capped at 0.4 (no false storms), high-probability rain untouched.

---

## [1.1.3] — 2026-07-06 — Cut GeoSphere calls ~5× (fix 429 rate-limiting)
### Fixed
- The backend made **~67 GeoSphere calls per cycle** — the forecast loop *and*
  `check_and_push` each re-fetched all 11 nowcasts, plus a ground fetch and per-row
  verification each hit TAWES (~45 identical calls, since every city point shares the
  same 2 gauges). This tripped GeoSphere's **429** (`[ground] 429 Too Many Requests`),
  occasionally starving the nowcast → an Open-Meteo fallback that lags convection.
- Added per-cycle caches: **nowcast** by point (`_NOWCAST_TTL`) and **TAWES** by
  station-id (`_TAWES_TTL`), both < the 300 s cycle. Same-cycle reuse collapses the
  load to **~12 calls/cycle** (11 nowcast + 1 TAWES) — fresh data each cycle, no 429.

_Note: investigation showed the missed-downpour report was primarily convective
nowcast limitation (a 6 pm cell isn't predictable at noon; the backend detected it only
as it arrived), not this rate-limit — but the 429 was a real reliability risk regardless._

---

## [1.1.2] — 2026-07-06 — Decouple the two upstream APIs (resilience)
### Fixed
- `/api/ambient` served **nothing** whenever the Open-Meteo call failed (e.g. its daily
  limit), because the GeoSphere ground + nowcast were attached to points that only
  existed on Open-Meteo success — so one API being down wiped the other's data, and a
  redeploy (which clears the in-memory snapshot) exposed it. Now, if Open-Meteo fails
  and there's no prior snapshot, the backend seeds a POINTS skeleton (null weather) so
  the ground + nowcast still reach clients. Clients already null-guard the weather fields.

---

## [1.1.1] — 2026-07-06 — Fix broken install-prompt icon
### Fixed
- The install popup showed a broken-image placeholder — it referenced a
  non-existent `/icon-192.png`. Pointed it at the real `/android-chrome-192x192.png`.

---

## [1.1.0] — 2026-07-06 — Catch the drizzle the gauges miss
Policy shift toward caution: **better to keep someone in than send them into rain.**

### Changed (rain logic)
- **Surface a light drizzle when the gauge reads dry.** When a TAWES gauge reads dry
  but the radar / RainViewer see a **light** echo (0.1–0.5 mm) at your spot the sparse
  gauges miss, the verdict now shows **GO ANYWAY** instead of GEMMA RAUS. Only light
  echo surfaces — bumped into the light band, **capped so it can never become a false
  STUCK**; a genuine heavier cell keeps the ground's dry call. (`effectivePrecip`,
  loadData + computeStatusAt; `rvRainActive` suppresses the `gapNow` override.)
- **Virga filter caps instead of zeroing.** Low-confidence echo (< 50% probability) is
  now capped to ~light (0.4 mm) rather than zeroed. This stops the ribbon claiming a
  false "no rain in 3 h" over a real drizzle, while still preventing a low-confidence
  heavy echo from painting a storm / forcing STUCK.

### Trade-off (accepted)
On a genuinely dry virga day the app may occasionally say "GO ANYWAY, light drizzle"
when it's actually dry — the deliberate price of never sending someone into rain.

---

## [1.0.0] — 2026-07-06 — First public release
First version shipped to the public. Consolidates the stability + accuracy work.

### Added
- **Imminent-downpour warning** — GO / light states surface "heavy rain in ~X min"
  when the (virga-filtered) radar shows ≥1.5 mm within 30 min, so "go anyway" can't
  walk you into a convective downpour the model missed.
- **Install-as-app prompt** — one-time, closable nudge ~2 s after load for new users;
  browser-aware (Chrome/Edge install button, iOS Safari Share sheet, Android → Chrome).
- **Passive "notice" voice** for map popups (separate from the first-person banner).
- **Rain-ribbon dry/empty label** ("no rain in the next 3 h" vs "waiting for data").
- **App version** shown in the info panel.

### Changed / Fixed (rain logic & data)
- **Ground reading served from the backend** — stabilises the NOW verdict; ends the
  GO ANYWAY↔STUCK flip caused by the per-IP TAWES call failing under rate limits.
- **Nowcast served from the backend** — fixes the ribbon/verdict flip-flopping on
  mobile CGNAT (per-IP GeoSphere rate limits).
- **Virga filter** — suppresses light radar echo the model rejects (stable-day false rain).
- **Rain ribbon reads the same ground-truth as the headline** (no rain↔dry flicker).
- **Map dot you're standing in mirrors your live headline** (no transient mismatch).
- **Relocate crosshair** — spinner feedback + 10 s cooldown + 30 s cap.

_Full logic history: CLAUDE.md → **Logic change log**._
