# Changelog

All notable, user- or logic-affecting changes to Gemma Raus. Newest first.
Versioning is [SemVer](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — a breaking change or a full re-architecture.
- **MINOR** — a new feature or a behavioural change to the rain logic.
- **PATCH** — a bug fix or copy/UI tweak with no logic change.

Each release is tagged in git as `vMAJOR.MINOR.PATCH`. To roll back, redeploy the
previous tag (see CLAUDE.md → **Versioning & rollback**).

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
